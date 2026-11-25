import { mountWorkbench } from "./workbench.js";
import { detectSiteLocale, saveSiteLocale, getSiteCopy } from "./i18n.js";

let locale = detectSiteLocale();
const toggle = document.querySelector('#lang-toggle');
function applyLocale() {
  const copy = getSiteCopy(locale);
  document.documentElement.lang = locale;
  document.title = locale === 'zh-CN' ? 'Beads Tasks · Antigravity 插件' : 'Beads Tasks · Antigravity Plugin';
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const value = copy[el.dataset.i18n];
    if (value == null) return;
    if (el.hasAttribute('data-i18n-html')) el.innerHTML = value;
    else el.textContent = value;
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => el.setAttribute('aria-label', copy[el.dataset.i18nAria]));
  toggle.textContent = locale === 'en' ? '中文' : 'EN';
  toggle.setAttribute('aria-label', locale === 'en' ? 'Switch language to Chinese' : 'Switch language to English');
  document.querySelectorAll('[data-copy]').forEach(button => { button.textContent = copy[button.dataset.copyState || '复制']; });
}
applyLocale();
const workbench = mountWorkbench(document.querySelector('#workbench-root'), { locale });
toggle.addEventListener('click', () => {
  locale = locale === 'en' ? 'zh-CN' : 'en';
  saveSiteLocale(locale);
  applyLocale();
  workbench.hostLocaleChanged(locale);
});
const links = [...document.querySelectorAll('.site-header nav a')];
const sections = links.map(link => document.querySelector(link.getAttribute('href')));
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) links.forEach(link => {
    const active = link.getAttribute('href') === `#${entry.target.id}`;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
  });
}, { rootMargin: '-49px 0px -70% 0px', threshold: 0 });
sections.forEach(section => observer.observe(section));
window.addEventListener('scroll', () => {
  if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) links.forEach(link => {
    const active = link.getAttribute('href') === '#playground';
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
  });
}, { passive: true });
document.querySelector('#theme').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  workbench.hostThemeChanged(theme);
});
document.querySelector('#reset').addEventListener('click', () => workbench.reset());
document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    const text = document.getElementById(button.dataset.copy).textContent;
    let copied = false;
    try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(text); copied = true; }
    catch {
      const field = document.createElement('textarea'); field.value = text; document.body.append(field); field.select();
      try { copied = document.execCommand('copy'); } catch {} finally { field.remove(); }
    }
    button.dataset.copyState = copied ? '已复制' : '复制失败';
    button.textContent = getSiteCopy(locale)[button.dataset.copyState];
    setTimeout(() => { button.dataset.copyState = '复制'; button.textContent = getSiteCopy(locale)['复制']; }, 2000);
  });
});
