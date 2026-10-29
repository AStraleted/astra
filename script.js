/* Squled Studio — портфолио: шапка, появление блоков, переключатель цен, просмотр работ */
document.documentElement.classList.add("js");
document.getElementById("year").textContent = new Date().getFullYear();

// Граница у шапки после прокрутки
const header = document.getElementById("top");
const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 8);
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

// Плавное появление блоков
const io = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
}, { threshold: 0.12 });
document.querySelectorAll(".reveal").forEach((el, i) => {
  el.style.transitionDelay = `${(i % 4) * 70}ms`;
  io.observe(el);
});

// Анимированный / статичный
document.querySelectorAll(".seg button").forEach(btn => {
  btn.addEventListener("click", () => {
    const kind = btn.dataset.kind;
    document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-selected", String(b === btn)));
    document.querySelectorAll(".price-val").forEach(el => {
      el.textContent = el.dataset[kind];
      el.classList.remove("flip"); void el.offsetWidth; el.classList.add("flip");
    });
    document.querySelectorAll(".feat li[data-for]").forEach(li => { li.hidden = li.dataset.for !== kind; });
  });
});

// Видео в сетке играют только когда видны
const vio = new IntersectionObserver(entries => {
  for (const e of entries) e.isIntersecting ? e.target.play().catch(() => {}) : e.target.pause();
}, { threshold: 0.2 });
document.querySelectorAll(".work video").forEach(v => vio.observe(v));

// Просмотр работы крупно, со звуком
const viewer = document.getElementById("viewer");
const vVideo = viewer.querySelector("video");
function openViewer(src) {
  vVideo.src = src;
  viewer.hidden = false;
  document.body.style.overflow = "hidden";
  vVideo.play().catch(() => {});
  viewer.querySelector(".viewer-close").focus();
}
function closeViewer() {
  vVideo.pause();
  vVideo.removeAttribute("src");
  vVideo.load();
  viewer.hidden = true;
  document.body.style.overflow = "";
}
document.querySelectorAll(".work").forEach(w => w.addEventListener("click", () => openViewer(w.dataset.src)));
viewer.addEventListener("click", e => { if (e.target === viewer || e.target.closest(".viewer-close")) closeViewer(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !viewer.hidden) closeViewer(); });
