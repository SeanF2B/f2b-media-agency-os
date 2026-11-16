import test from "node:test";
import assert from "node:assert/strict";
import { parseTeam, parseGallery, findTeamHref, findGalleryHref } from "../lib/scheduling/site-sample.ts";

const pad = (n) => `<div>${" ".repeat(n)}</div>`;

test("photo after the name (WordPress artists page), with their work images and guests cut off", () => {
  const html = `<img src="/logo.webp" alt="logo"><h2>Our Expert Tattoo Artists Are As Follows -</h2>
    <h2>Jeliza Rose</h2>${pad(200)}<img src="/u/artist-page-1.webp"><img src="/u/jeliza-1.webp"><img src="/u/jeliza-2.webp">${pad(900)}
    <h2>Gin</h2>${pad(200)}<img src="/u/artist-page-3.webp"><img src="/u/gin-1.webp">
    <h1>Guest Artist</h1><h3>Simona Cordero</h3><img src="/u/guest.png">`;
  const r = parseTeam(html, "https://studio.example/artists/");
  assert.deepEqual(r.team, ["Jeliza Rose", "Gin"]);
  assert.equal(r.photos["Jeliza Rose"], "https://studio.example/u/artist-page-1.webp");
  assert.equal(r.photos.Gin, "https://studio.example/u/artist-page-3.webp");
  assert.deepEqual(r.work["Jeliza Rose"], ["https://studio.example/u/jeliza-1.webp", "https://studio.example/u/jeliza-2.webp"]);
  assert.deepEqual(r.work.Gin, ["https://studio.example/u/gin-1.webp"]);
});

test("photo before the name with blank placeholders between (Duda team page)", () => {
  const html = `<h1>Meet The Team</h1><img data-src="https://cdn.example/cj-1920w.jpg" alt="CJ"><h3>CJ</h3>${pad(1000)}<img data-src="https://cdn.example/empty_02-1920w.png">${pad(300)}
    <img data-src="https://cdn.example/IMG_4294.JPG">${pad(1400)}<img data-src="https://cdn.example/empty_02-1920w.png"><h3>Keele</h3>${pad(1400)}<img data-src="https://cdn.example/Cover.jpg">${pad(1400)}<h3>Tyra</h3>
    <h3>Our Work</h3><h3>Adriana</h3>`;
  const r = parseTeam(html, "https://apex.example/meet-the-team");
  assert.deepEqual(r.team, ["CJ", "Keele", "Tyra"]);
  assert.equal(r.photos.CJ, "https://cdn.example/cj-1920w.jpg");
  assert.equal(r.photos.Keele, "https://cdn.example/IMG_4294.JPG");
  assert.equal(r.photos.Tyra, "https://cdn.example/Cover.jpg");
});

test("team and gallery links stay on the same site; gallery skips logos", () => {
  const home = `<a href="https://x.example/artists/">Artists</a><a href="/tattoo-gallery">Gallery</a><a href="https://other.example/team">x</a>`;
  assert.equal(findTeamHref(home, "https://x.example/"), "https://x.example/artists/");
  assert.equal(findGalleryHref(home, "https://x.example/"), "https://x.example/tattoo-gallery");
  assert.equal(findTeamHref(`<a href="https://other.example/team">x</a>`, "https://x.example/"), "");
  assert.deepEqual(parseGallery(`<img src="/apex+no+bg.png"><img src="/a.jpg"><img src="/a.jpg"><img src="/b.jpg">`, "https://x.example/g"), ["https://x.example/a.jpg", "https://x.example/b.jpg"]);
});
