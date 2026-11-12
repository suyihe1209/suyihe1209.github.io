// 首页歌词精讲曲目列表：从内联的 LYRICS_DATA 渲染，仅保留歌手 + 曲名，15 首全展示
(function () {
  function renderSongs() {
    const list = document.getElementById("songList");
    if (!list) return;
    if (typeof LYRICS_DATA === "undefined") {
      list.innerHTML = '<p style="color:var(--muted)">曲目数据加载失败。</p>';
      return;
    }
    list.innerHTML = LYRICS_DATA.songs.map(s => `
      <a class="post-card card song-mini" href="lyrics/${s.file}">
        <span class="post-date">#${String(s.seq).padStart(2, "0")} · ${s.artist}</span>
        <h3>${s.title}</h3>
      </a>
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

    // 首页参与滚动高亮的页内板块（按页面顺序）。
    // 注意：不含 about —— 导航里的「关于」是跨页链接(about.html)，不是页内锚点，
    // 若让 about section 触发高亮会造成「看着高亮、点了却跳页」的误导。
    const sectionIds = ["lyrics", "posts", "tools"];
    const sections = sectionIds
      .map((id) => document.getElementById(id))
      .filter(Boolean);

    if (sections.length === 0) return;

    function setActive(key) {
      links.forEach((a) => {
        a.classList.toggle("active", a.getAttribute("data-nav") === key);
      });
    }

    // 页面顶部（hero 区）→ 高亮「首页」
    function checkTop() {
      const hero = document.querySelector(".hero");
      if (!hero) return;
      const r = hero.getBoundingClientRect();
      // hero 底部还没完全滚出视口上沿时，视为「在顶部」
      if (r.bottom > 80) setActive("home");
    }

    const observer = new IntersectionObserver(
      (entries) => {
        // 取「最靠视口上方的可见 section」来高亮
        let current = null;
        let minTop = Infinity;
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const top = e.target.getBoundingClientRect().top;
            if (top < minTop) {
              minTop = top;
              current = e.target.id;
            }
          }
        });
        if (current) {
          setActive(current);
        } else {
          checkTop();
        }
      },
      { rootMargin: "-80px 0px -40% 0px", threshold: 0 }
    );

    sections.forEach((s) => observer.observe(s));

    // 初始状态 & 滚回顶部时恢复「首页」高亮
    window.addEventListener("scroll", () => {
      if (window.scrollY < 120) setActive("home");
    }, { passive: true });
  }

  document.addEventListener("DOMContentLoaded", initScrollSpy);
})();
