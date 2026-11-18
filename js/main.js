/* Nova shared script. Developed by Rishikesh Singh */
(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Highlight the current page in the menu
  const page = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".links a").forEach((a) => {
    if (a.getAttribute("href") === page) a.classList.add("active");
  });

  // Footer year
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();

  // 3D tilt on cards that follows the mouse
  if (!reduce) {
    document.querySelectorAll(".card, .hero-inner").forEach((el) => {
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `perspective(1000px) rotateX(${(-y * 10).toFixed(2)}deg) rotateY(${(x * 12).toFixed(2)}deg) translateZ(12px)`;
      });
      el.addEventListener("pointerleave", () => (el.style.transform = ""));
    });
  }
})();
