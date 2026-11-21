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

test("menu labels, section titles and reviewer names are never read as team (sole-trader about page)", async () => {
  const { looksLikePerson } = await import("../lib/scheduling/site-sample.ts");
  const html = `<header><nav><div class="dropdown"><h4>Bridal</h4><h4>Occasions</h4><h4>Areas</h4></div></nav></header>
    <div class="mobile-drawer"><h4>Bridal</h4><h4>More</h4></div>
    <h1>Your Makeup Artist, Lea</h1><img src="/u/lea.jpg" alt="Lea Flanagan, mobile makeup artist in Dublin">
    <h2>5 Star Reviews</h2><strong>Aimee Carroll</strong><strong>Donna Murphy</strong>
    <h2>Professional Makeup Artist</h2><h3>Mobile Service</h3><h3>Any Occasion</h3><h3>Premium Products</h3>
    <footer><h4>Services</h4><h4>Areas</h4><h4>Explore</h4></footer>`;
  const r = parseTeam(html, "https://mua.example/about/");
  for (const bad of ["Bridal", "Occasions", "Areas", "More", "Professional Makeup Artist", "Any Occasion", "Mobile Service", "Premium Products", "Aimee Carroll", "Donna Murphy", "Explore"]) assert.ok(!r.team.includes(bad), bad);
  assert.deepEqual(r.team, ["Lea Flanagan"]);
  assert.equal(r.photos["Lea Flanagan"], "https://mua.example/u/lea.jpg");
  assert.equal(looksLikePerson("Any Occasion"), false);
  assert.equal(looksLikePerson("Jeliza Rose"), true);
  assert.equal(looksLikePerson("CJ"), true);
});

test("gift-voucher feature headings are never read as team names", () => {
  const html = `<h2>Meet the team</h2><h3>Gift Vouchers</h3><h3>Flexible Amounts</h3><img src="/a.jpg"><h3>Instant Delivery</h3><img src="/b.jpg"><h3>Perfect Gift</h3>`;
  const r = parseTeam(html, "https://studio.example/");
  assert.deepEqual(r.team, []);
});

test("body theme classes like ehf-header don't hide the whole team page (The Black Poppy)", () => {
  const html = `<body class="page wp-theme-kadence ehf-header ehf-footer"><nav><h2>Home</h2></nav><h2>Our Expert Tattoo Artists Are As Follows -</h2>
    <h2>Jeliza Rose</h2><img src="/u/jeliza.webp"><h2>Elena</h2><img src="/u/elena.webp"><h2>Gin</h2><img src="/u/gin.webp"><h2>Slim</h2><img src="/u/slim.webp"><h2>Fiorella</h2><img src="/u/fio.webp">
    <h1>Guest Artist</h1><h3>Simona Cordero</h3><footer><h2>Hours</h2></footer></body>`;
  const r = parseTeam(html, "https://theblackpoppycork.com/artists/");
  assert.deepEqual(r.team, ["Jeliza Rose", "Elena", "Gin", "Slim", "Fiorella"]);
});
