(() => {
  const lyrics = document.getElementById("lyrics");
  const bar = document.getElementById("bar");
  const stage = document.getElementById("stage");
  const labels = {n5:"N5", n4:"N4", n3:"N3", n2:"N2+", lit:"文語", rep:"重复"};
  const pad = number => String(number).padStart(2, "0");
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char =>
    ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[char]);
  const normalize = value => value.normalize("NFKC").toLowerCase()
    .replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replace(/[āīūēō]/g, char => ({ā:"aa", ī:"ii", ū:"uu", ē:"ee", ō:"oo"})[char])
    .trim();
  const searchField = value => normalize(value).replace(/\s+/g, "");
  const terms = value => normalize(value).split(/\s+/).filter(Boolean);
  const matches = (field, query) => query.every(term => field.includes(term));
  const lineLink = (id, text) => `<a href="#${id}" aria-label="第 ${text} 行">${text}</a>`;
  const parseData = document.getElementById("song-data");
  const quickSearch = document.getElementById("q");
  const quickCount = document.getElementById("cnt");
  const quickAll = document.getElementById("allBtn");
  const initial = {rd:true, ro:!quickSearch, tr:true};
  let rows = [];

  if (parseData) {
    const data = JSON.parse(parseData.textContent);
    const sections = Array.isArray(data) ? data : data.sections;
    const firstByText = new Map();
    const vocab = new Map();
    let number = 0;
    lyrics.innerHTML = sections.map((section, index) => {
      const sectionId = `section-${pad(index + 1)}`;
      const lines = section.lines.map(line => {
        const num = pad(++number);
        const id = `line-${num}`;
        const original = firstByText.get(line.t);
        if (!original) firstByText.set(line.t, {num, id, words:line.w});
        const words = line.w?.length ? line.w : line.lv === "rep" ? original?.words : [];
        for (const [word, reading, , meaning, note] of words ?? []) {
          const key = JSON.stringify([word, reading]);
          if (!vocab.has(key)) vocab.set(key, {word, reading, meanings:new Set(), notes:new Set(), ids:new Map()});
          const entry = vocab.get(key);
          if (meaning) entry.meanings.add(meaning);
          if (note) entry.notes.add(note);
          entry.ids.set(id, num);
        }
        const cells = [["w","词"], ["rd2","读音"], ["pos","词性"], ["mn","释义"], ["nt","备注"]];
        const table = line.w?.length ? `<h4>逐词拆解</h4><table class="sx"><thead><tr>
          ${["词／表达","读音","词性","释义","备注"].map(label => `<th scope="col">${label}</th>`).join("")}
          </tr></thead><tbody>${line.w.map(word => `<tr>${cells.map(([type, label], i) =>
            `<td class="${type}" data-h="${label}"${i < 2 ? ' lang="ja"' : ""}>${escape(word[i])}</td>`
          ).join("")}</tr>`).join("")}</tbody></table>` : "";
        const grammar = line.g?.length ? `<h4>句法与语法</h4>${line.g.map(([name, note]) =>
          `<div class="g"><b>${name}</b><br>${note}</div>`).join("")}` : "";
        const crossReference = line.lv === "rep" && original
          ? `<p class="note">与第 ${lineLink(original.id, original.num)} 行原文相同。</p>` : "";
        return `<details class="line${line.lv === "rep" ? " repcard" : ""}" id="${id}" data-level="${escape(line.lv)}">
          <summary class="head"><span class="orig" lang="ja">${escape(line.t)}</span>
            <span class="rd" lang="ja">${escape(line.r)}</span>
            <span class="ro" lang="ja-Latn">${escape(line.ro)}</span>
            <span class="tr">${line.tr ?? ""}</span>
            <span class="foot"><span class="section-key">第 ${num} 行</span><span class="lv ${escape(line.lv)}">${escape(labels[line.lv] || line.lv)}</span></span>
            <span class="chev" aria-hidden="true">▾</span>
          </summary>
          <div class="detail">${table}${grammar}
            ${line.p ? `<div class="plain"><b>大白话：</b>${line.p}</div>` : ""}
            ${line.tip ? `<div class="tip"><b>提示：</b>${line.tip}</div>` : ""}
            ${crossReference}
          </div>
        </details>`;
      });
      return `<section class="sec" id="${sectionId}" aria-labelledby="label-${pad(index + 1)}">
        <div class="sec-h"><span class="n">${escape(section.n)}</span>
          <h3 id="label-${pad(index + 1)}">${escape(section.h)}</h3>
          <span class="jp">${escape(section.jp)}</span><span class="sp"></span>
          <span class="sec-cnt"></span><button type="button" class="sec-tg">展开本节</button>
        </div>
        <details class="passage"><summary>整段连读 · ${section.passage ? "自然译文" : "逐行译文"}</summary>
          <p>${section.passage ? escape(section.passage) : section.lines.map(line => line.tr ?? "").join("<br>")}</p>
        </details>
        ${lines.join("")}
      </section>`;
    }).join("");

    document.getElementById("study-toc").innerHTML = sections.map((section, index) =>
      `<a href="#section-${pad(index + 1)}">${escape(section.n)}　${escape(section.h)}</a>`).join("");
    const collator = new Intl.Collator("ja");
    const entries = [...vocab.values()].sort((a, b) => collator.compare(a.reading || a.word, b.reading || b.word));
    const vocabBody = document.querySelector("#vocab tbody");
    vocabBody.innerHTML = entries.map(entry => `<tr>
      <td class="w" lang="ja">${escape(entry.word)}</td><td class="rd2" lang="ja">${escape(entry.reading)}</td>
      <td class="mn">${escape([...entry.meanings].join(" ／ "))}</td>
      <td><div class="vocab-links">${[...entry.ids].map(([id, num]) => lineLink(id, num)).join("")}</div></td>
    </tr>`).join("");
    rows = [...vocabBody.rows].map((element, index) => ({
      element, field:searchField(element.textContent + " " + [...entries[index].notes].join(" "))
    }));
  } else {
    rows = [...document.querySelectorAll("#vocab tbody tr")].map(element => ({
      element, field:searchField(element.textContent + " " + (element.dataset.variants || ""))
    }));
    const level = document.getElementById("level");
    if (lyrics.querySelector(".lv.rep")) level.add(new Option("重复唱段", "rep"));
  }

  const search = document.getElementById("search");
  const level = document.getElementById("level");
  const count = document.getElementById("count");
  const vocabSearch = document.getElementById("vocab-search");
  const vocabCount = document.getElementById("vocab-count");
  const empty = document.getElementById("empty");
  const sections = [...lyrics.querySelectorAll(".sec")].map(element => ({
    element,
    count:element.querySelector(".sec-cnt"),
    button:element.querySelector(".sec-tg"),
    lines:[...element.querySelectorAll("details.line")].map(line => ({
      element:line,
      repeated:[...line.querySelectorAll(".lv.rep")].some(badge => badge.textContent.trim() === "重复"),
      field:searchField(line.textContent + " " + (line.dataset.terms || ""))
    }))
  }));
  const total = sections.reduce((sum, section) => sum + section.lines.length, 0);
  const visibleLines = section => section.lines.map(line => line.element).filter(line => !line.hidden);

  function syncSection(section) {
    const lines = visibleLines(section);
    section.button.textContent = lines.length && lines.every(line => line.open) ? "收起本节" : "展开本节";
  }

  function syncQuickAll() {
    if (!quickAll) return;
    const shown = sections.flatMap(visibleLines);
    const allOpen = shown.length > 0 && shown.every(line => line.open);
    quickAll.textContent = allOpen ? "全部收起" : "全部展开";
    quickAll.setAttribute("aria-pressed", String(allOpen));
    quickAll.classList.toggle("on", allOpen);
    quickAll.disabled = shown.length === 0;
  }

  function filterLyrics() {
    const query = terms(search.value);
    let visible = 0;
    for (const section of sections) {
      for (const {element, field, repeated} of section.lines) {
        const levelMatches = !level.value || (level.value === "rep" ? repeated : element.dataset.level === level.value);
        element.hidden = !(levelMatches && matches(field, query));
      }
      const shown = visibleLines(section).length;
      section.element.hidden = shown === 0;
      section.count.textContent = shown === section.lines.length ? `${shown} 行` : `${shown} / ${section.lines.length} 行`;
      visible += shown;
      syncSection(section);
    }
    count.textContent = `${visible} / ${total} 行`;
    if (quickCount) quickCount.textContent = count.textContent;
    empty.hidden = visible > 0;
    empty.classList.toggle("on", visible === 0);
    syncQuickAll();
  }

  function filterVocab() {
    const query = terms(vocabSearch.value);
    let visible = 0;
    for (const {element, field} of rows) {
      element.hidden = !matches(field, query);
      if (!element.hidden) visible++;
    }
    vocabCount.textContent = `${visible} / ${rows.length} 词条${visible ? "" : " · 没有匹配"}`;
  }

  function moveTo(target) {
    if (target.matches("details.line")) {
      target.open = true;
      target.querySelector("summary").focus({preventScroll:true});
    }
    target.scrollIntoView({block:"start"});
  }

  function resolveJump(hash) {
    if (!/^#(?:line|section)-\d+$/.test(hash)) return;
    const target = document.getElementById(hash.slice(1));
    if (!target) return;
    if (target.hidden || target.closest(".sec")?.hidden) {
      search.value = "";
      if (quickSearch) quickSearch.value = "";
      level.value = "";
      filterLyrics();
    }
    moveTo(target);
  }

  for (const section of sections) {
    section.button.hidden = false;
    section.button.addEventListener("click", () => {
      const lines = visibleLines(section);
      const shouldOpen = lines.some(line => !line.open);
      lines.forEach(line => { line.open = shouldOpen; });
      syncSection(section);
    });
    section.lines.forEach(({element}) => element.addEventListener("toggle", () => {
      syncSection(section);
      syncQuickAll();
    }));
  }
  function setAll(open) {
    for (const section of sections) {
      const lines = open ? visibleLines(section) : section.lines.map(line => line.element);
      lines.forEach(line => { line.open = open; });
      syncSection(section);
    }
    syncQuickAll();
  }
  document.getElementById("open-all").addEventListener("click", () => setAll(true));
  document.getElementById("close-all").addEventListener("click", () => setAll(false));
  quickAll?.addEventListener("click", () => setAll(quickAll.getAttribute("aria-pressed") !== "true"));
  const searchInputs = quickSearch ? [search, quickSearch] : [search];
  for (const input of searchInputs) {
    input.addEventListener("input", () => {
      for (const other of searchInputs) if (other !== input) other.value = input.value;
      filterLyrics();
    });
    input.addEventListener("keydown", event => {
      if (event.isComposing) return;
      if (event.key === "Enter") moveTo(sections.flatMap(visibleLines)[0] || empty);
      if (event.key === "Escape" && input.value) {
        event.preventDefault();
        searchInputs.forEach(field => { field.value = ""; });
        filterLyrics();
      }
    });
  }
  const quickTools = document.getElementById("toolsBtn");
  quickTools?.addEventListener("click", () => {
    const open = bar.classList.toggle("tools-open");
    quickTools.setAttribute("aria-expanded", String(open));
  });
  if (quickSearch) document.addEventListener("keydown", event => {
    if (event.key !== "/" || event.ctrlKey || event.altKey || event.metaKey || event.isComposing ||
        event.target.closest("input,textarea,select,[contenteditable]")) return;
    event.preventDefault();
    quickSearch.focus();
  });
  level.addEventListener("change", filterLyrics);
  vocabSearch.addEventListener("input", filterVocab);

  try {
    const saved = JSON.parse(localStorage.getItem("wbState") || "{}");
    for (const key of Object.keys(initial)) if (typeof saved?.[key] === "boolean") initial[key] = saved[key];
  } catch { /* file:// can disable storage */ }
  const toggles = [...document.querySelectorAll("[data-layer], #toolbox [data-k]")];
  for (const key of Object.keys(initial)) {
    const buttons = toggles.filter(button => (button.dataset.layer || button.dataset.k) === key);
    function applyLayer() {
      stage.classList.toggle("hide-" + key, !initial[key]);
      for (const button of buttons) {
        button.setAttribute("aria-pressed", String(initial[key]));
        button.classList.toggle("on", initial[key]);
      }
    }
    applyLayer();
    for (const button of buttons) button.addEventListener("click", () => {
      initial[key] = !initial[key];
      applyLayer();
      try { localStorage.setItem("wbState", JSON.stringify(initial)); } catch { /* optional preference */ }
    });
  }

  document.addEventListener("click", event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest('a[href^="#"]');
    if (anchor?.hash === location.hash) resolveJump(anchor.hash);
  });
  window.addEventListener("hashchange", () => resolveJump(location.hash));
  window.addEventListener("load", () => resolveJump(location.hash));
  function syncNavHeight() {
    document.documentElement.style.setProperty("--nav-h", Math.ceil(bar.getBoundingClientRect().height) + "px");
  }
  if (window.ResizeObserver) new ResizeObserver(syncNavHeight).observe(bar);
  else window.addEventListener("resize", syncNavHeight);
  for (const id of ["tools", "controls", "vocab-tools"]) document.getElementById(id).hidden = false;
  filterLyrics();
  filterVocab();
  syncNavHeight();
})();
