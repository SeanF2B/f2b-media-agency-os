// Reads GPS position and capture date from a JPEG photo's EXIF block in the browser (phones store these).
// Returns nothing for other formats or photos without location data. No network calls.
export type PhotoGeo = { lat?: number; lng?: number; takenAt?: string };

export async function readPhotoGeo(file: File): Promise<PhotoGeo> {
  try {
    if (!/jpe?g$/i.test(file.type.split("/")[1] || "") && !/\.jpe?g$/i.test(file.name)) return {};
    const view = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (view.getUint16(0) !== 0xffd8) return {};
    let offset = 2;
    while (offset + 4 < view.byteLength) {
      const marker = view.getUint16(offset);
      const length = view.getUint16(offset + 2);
      if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) return parseTiff(view, offset + 10);
      if ((marker & 0xff00) !== 0xff00) break;
      offset += 2 + length;
    }
  } catch { /* unreadable EXIF */ }
  return {};
}

function parseTiff(view: DataView, start: number): PhotoGeo {
  const little = view.getUint16(start) === 0x4949;
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  const readIfd = (at: number) => {
    const entries = new Map<number, { type: number; count: number; valueAt: number }>();
    const count = u16(at);
    for (let i = 0; i < count; i += 1) {
      const entry = at + 2 + i * 12;
      const type = u16(entry + 2), n = u32(entry + 4);
      const size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 } as Record<number, number>)[type] || 1;
      entries.set(u16(entry), { type, count: n, valueAt: size * n > 4 ? start + u32(entry + 8) : entry + 8 });
    }
    return entries;
  };
  const ascii = (e?: { count: number; valueAt: number }) => { if (!e) return ""; let s = ""; for (let i = 0; i < e.count - 1; i += 1) s += String.fromCharCode(view.getUint8(e.valueAt + i)); return s; };
  const rationals = (e?: { count: number; valueAt: number }) => { const out: number[] = []; if (!e) return out; for (let i = 0; i < e.count; i += 1) { const d = u32(e.valueAt + i * 8 + 4); out.push(d ? u32(e.valueAt + i * 8) / d : 0); } return out; };
  const ifd0 = readIfd(start + u32(start + 4));
  const result: PhotoGeo = {};
  const exifPtr = ifd0.get(0x8769);
  if (exifPtr) { const exif = readIfd(start + u32(exifPtr.valueAt)); const raw = ascii(exif.get(0x9003)); const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})/); if (m) result.takenAt = `${m[1]}-${m[2]}-${m[3]}`; }
  const gpsPtr = ifd0.get(0x8825);
  if (gpsPtr) {
    const gps = readIfd(start + u32(gpsPtr.valueAt));
    const lat = rationals(gps.get(2)), lng = rationals(gps.get(4));
    if (lat.length === 3 && lng.length === 3) {
      const toDeg = (v: number[]) => v[0] + v[1] / 60 + v[2] / 3600;
      const latRef = ascii(gps.get(1)) || "N", lngRef = ascii(gps.get(3)) || "E";
      const la = toDeg(lat) * (latRef === "S" ? -1 : 1), lo = toDeg(lng) * (lngRef === "W" ? -1 : 1);
      if (Number.isFinite(la) && Number.isFinite(lo) && (la !== 0 || lo !== 0)) { result.lat = Math.round(la * 1e6) / 1e6; result.lng = Math.round(lo * 1e6) / 1e6; }
    }
  }
  return result;
}
