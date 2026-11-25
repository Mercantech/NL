import { projectLinks } from "./projekter-2026-data.mjs?v=20261125a";

const entries = [...document.querySelectorAll("[data-project]")];
const search = document.querySelector("#project-search");
const empty = document.querySelector("#no-projects");
const normalize = (value) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

function filterProjects() {
  const query = normalize(search.value);
  for (const entry of entries) {
    const names = [...entry.querySelectorAll("h2, .project-member")].map(node => node.textContent);
    entry.hidden = !names.some(name => normalize(name).includes(query));
  }
  empty.hidden = entries.some(entry => !entry.hidden);
}

const linkKeys = { github: "projects.github", docs: "projects.docs", site: "projects.site" };
for (const entry of entries) {
  const container = entry.querySelector(".project-links");
  for (const { type, url, label } of projectLinks[entry.id] || []) {
    if (!/^https?:\/\//i.test(url) || !Object.hasOwn(linkKeys, type)) continue;
    const link = document.createElement("a");
    link.href = url;
    if (type === "github") link.classList.add("project-github");
    if (label) link.textContent = label;
    else {
      link.dataset.i18n = linkKeys[type];
      link.textContent = window.SiteI18n.t(linkKeys[type]);
    }
    container.append(link);
    container.querySelector(".project-pending").hidden = true;
  }
}
document.querySelector(".project-search").hidden = false;
search.addEventListener("input", filterProjects);
filterProjects();
