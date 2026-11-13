const attr = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const js = (value: string) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

export function marketingEmbedSnippet(src: string, assetId: string, slug: string, title: string) {
  let url: URL;
  try { url = new URL(src); } catch { return ""; }
  if (url.protocol !== "https:") return "";
  const id = `f2b-marketing-${assetId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80)}`;
  if (id === "f2b-marketing-") return "";
  const target = js(url.origin);
  const safeSlug = js(slug);
  const safeId = js(id);
  return `<iframe id="${attr(id)}" data-src="${attr(url.toString())}" width="100%" height="720" title="${attr(title)}" loading="lazy" style="display:block;width:100%;height:720px;min-height:320px;border:0"></iframe>\n<script>(function(){var f=document.getElementById(${safeId});if(!f)return;var origin=${target};var slug=${safeSlug};var pageUrl=new URL(window.location.href);var frameUrl=new URL(f.dataset.src);var stored={};try{stored=JSON.parse(localStorage.getItem("f2b_attr")||"{}")||{}}catch(e){}var ref="";try{var r=document.referrer?new URL(document.referrer):null;if(r&&r.hostname!==location.hostname)ref=r.hostname}catch(e){}["utm_source","utm_medium","utm_campaign","utm_content","utm_term","gclid","gbraid","wbraid"].forEach(function(key){var value=pageUrl.searchParams.get(key)||stored[key];if(value&&!frameUrl.searchParams.has(key))frameUrl.searchParams.set(key,String(value).slice(0,160))});if(!frameUrl.searchParams.has("f2b_ref")&&(ref||stored.referrer))frameUrl.searchParams.set("f2b_ref",String(ref||stored.referrer).slice(0,160));frameUrl.searchParams.set("f2b_landing",(location.hostname+location.pathname).slice(0,160));f.src=frameUrl.toString();function ready(){if(f.contentWindow)f.contentWindow.postMessage({type:"f2b-marketing-ready",slug:slug},origin)}f.addEventListener("load",ready);window.addEventListener("message",function(e){if(e.origin!==origin||e.source!==f.contentWindow)return;var d=e.data;if(!d||d.type!=="f2b-marketing-height"||d.slug!==slug||!Number.isFinite(d.height))return;f.style.height=Math.max(320,Math.min(20000,Math.ceil(d.height)))+"px"})})();</script>`;
}
