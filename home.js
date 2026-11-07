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
