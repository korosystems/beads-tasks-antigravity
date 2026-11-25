import { mountWorkbench } from "./workbench.js";

const workbench = mountWorkbench(document.querySelector("#workbench-root"));
const links = [...document.querySelectorAll('.site-header nav a')];
const sections = links.map((link) => document.querySelector(link.getAttribute("href")));
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      links.forEach((link) => {
        const active = link.getAttribute("href") === `#${entry.target.id}`;
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
    }
  }
}, { rootMargin: "-49px 0px -70% 0px", threshold: 0 });
sections.forEach((section) => observer.observe(section));
// 工作台固定在页面最底部，滚到底时直接兜底高亮 #playground。
window.addEventListener("scroll", () => {
  if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
    links.forEach((link) => {
      const active = link.getAttribute("href") === "#playground";
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }
}, { passive: true });

document.querySelector("#theme").addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  workbench.hostThemeChanged(theme);
});
document.querySelector("#reset").addEventListener("click", () => workbench.reset());
document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const text = document.getElementById(button.dataset.copy).textContent;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
    } catch {
      const field = document.createElement("textarea");
      field.value = text;
      document.body.append(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      if (!copied) { button.textContent = "复制失败"; return; }
    }
    button.textContent = "已复制";
    setTimeout(() => { button.textContent = "复制"; }, 2000);
  });
});
