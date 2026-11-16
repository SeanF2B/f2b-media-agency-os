// Fills inbox rows from the real people who will send: unique, natural address patterns.
// No invented names — the person types who the senders are.

const PATTERNS = [
  (f, l) => f,
  (f, l) => (l ? `${f}.${l}` : `${f}1`),
  (f, l) => (l ? `${f}${l[0]}` : `${f}.hello`),
  (f, l) => (l ? `${f[0]}.${l}` : `hi.${f}`),
  (f, l) => (l ? `${f}${l}` : `${f}.team`),
  (f, l) => (l ? `${f[0]}${l}` : `${f}.office`),
];

/** Lowercase ASCII letters only (accents removed: "Seán Ó Briain" → "sean", "obriain"). */
export function slug(value) {
  return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}

/** "Sean Murphy, Niamh Kelly" → [{ firstName, lastName }]. */
export function parsePeople(text) {
  return String(text || "").split(/[,;\n]+/).map((part) => part.trim()).filter(Boolean).map((part) => {
    const [first, ...rest] = part.split(/\s+/);
    return { firstName: first, lastName: rest.join(" ") };
  }).filter((person) => slug(person.firstName));
}

/**
 * `count` rows, spreading the people across rows in turn and giving each row a different address
 * pattern so every mailbox on a domain is unique and still looks like a real person's address.
 */
export function fillIdentities(people, count) {
  if (!people.length || count < 1) return [];
  const used = new Set(); const rows = [];
  const tries = new Map();
  for (let index = 0; index < count; index += 1) {
    const person = people[index % people.length];
    const first = slug(person.firstName), last = slug(person.lastName);
    let attempt = tries.get(person) || 0; let local = "";
    while (!local || used.has(local)) { local = PATTERNS[attempt % PATTERNS.length](first, last) + (attempt >= PATTERNS.length ? String(Math.floor(attempt / PATTERNS.length) + 1) : ""); attempt += 1; }
    tries.set(person, attempt);
    used.add(local);
    rows.push({ firstName: person.firstName, lastName: person.lastName, local });
  }
  return rows;
}
