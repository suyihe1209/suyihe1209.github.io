// 首页曲目目录：曲名优先，歌手次之，有深读篇时提供独立入口。
(function () {
  function renderSongs() {
    const list = document.getElementById("songList");
    if (!list) return;
    if (typeof LYRICS_DATA === "undefined") {
      list.innerHTML = '<p style="color:var(--muted)">曲目数据加载失败。</p>';
      return;
    }
    list.innerHTML = LYRICS_DATA.songs.map(s => `
      <div class="song-entry">
        <a class="post-card card song-mini" href="lyrics/${s.file}">
          <h3><span class="song-number">${String(s.seq).padStart(2, "0")}</span><span>${s.title}</span></h3>
          <span class="post-date">${s.artist}</span>
        </a>
        ${s.deep ? `<a class="song-deep" href="lyrics/${s.deep}" aria-label="${s.title} 深读篇">深读篇</a>` : ""}
      </div>
    `).join("");
  }

  document.addEventListener("DOMContentLoaded", renderSongs);
})();

// 当前页高亮：滚动到哪个板块，就高亮导航栏对应项（仅首页）
(function () {
  function initScrollSpy() {
    const nav = document.getElementById("siteNav");
    if (!nav) return;
    const links = nav.querySelectorAll("a[data-nav]");

    const header = nav.closest(".site-header");
    const tools = document.getElementById("tools");
    const lyrics = document.getElementById("lyrics");

    function updateCurrentSection() {
      const readingLine = header.getBoundingClientRect().bottom + 20;
      let key = "home";
      if (tools.getBoundingClientRect().top <= readingLine) key = "tools";
      if (lyrics.getBoundingClientRect().top <= readingLine) key = "lyrics";
      links.forEach((a) => {
        const active = a.dataset.nav === key;
        a.classList.toggle("active", active);
        if (active) a.setAttribute("aria-current", key === "home" ? "page" : "location");
        else a.removeAttribute("aria-current");
      });
    }

    window.addEventListener("scroll", updateCurrentSection, { passive: true });
    window.addEventListener("resize", updateCurrentSection);
    updateCurrentSection();
  }

  document.addEventListener("DOMContentLoaded", initScrollSpy);
})();

// 按需加载首页桌宠，收起时释放模型和事件监听。
// 顺带让首屏那排「挥手 / 出拳 / 低扫 / 闪避 / 整套连播」按钮也能指挥它。
(function () {
  const toggle = document.getElementById("petToggle");
  const host = document.getElementById("homePet");
  const feedback = document.getElementById("petFeedback");
  const heroActions = document.getElementById("heroPetActions");
  const petTag = "t800-companion";
  let loading = false;

  function setToggle(text, expanded) {
    if (!toggle) return;
    toggle.textContent = text;
    toggle.setAttribute("aria-expanded", String(expanded));
  }

  async function loadPet() {
    if (customElements.get(petTag)) return true;
    if (loading) return false;
    loading = true;
    const script = document.createElement("script");
    script.src = "tool-assets/t800-pet.js";
    await new Promise((resolve) => {
      script.addEventListener("load", resolve, { once: true });
      script.addEventListener("error", resolve, { once: true });
      document.head.append(script);
    });
    loading = false;
    if (customElements.get(petTag)) return true;
    script.remove();
    return false;
  }

  // 已经召唤过就复用，没有就现场叫一只
  async function ensurePet() {
    const alive = host.firstElementChild;
    if (alive) return alive;
    if (feedback) feedback.textContent = "";
    const ready = await loadPet();
    if (!ready) {
      setToggle("召唤桌宠", false);
      if (feedback) feedback.textContent = "桌宠加载失败，请再试一次。";
      return null;
    }
    const pet = document.createElement(petTag);
    host.append(pet);
    setToggle("收起桌宠", true);
    return pet;
  }

  function dismissPet() {
    if (host.firstElementChild) host.firstElementChild.remove();
    setToggle("召唤桌宠", false);
  }

  if (toggle) {
    toggle.hidden = false;
    toggle.addEventListener("click", async () => {
      if (host.firstElementChild) { dismissPet(); return; }
      if (loading) return;
      setToggle("召唤中…", false);
      const pet = await ensurePet();
      if (!pet) return;
    });
  }

  // 首屏动作按钮：没有桌宠就先叫一只，再让它做指定动作
  if (heroActions) {
    heroActions.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const pet = await ensurePet();
      if (!pet || typeof pet.act !== "function") return;
      pet.act(button.dataset.action);
    });
  }
})();
