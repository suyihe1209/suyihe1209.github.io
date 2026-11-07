// 博客文章数据。写新文章：在这里加一条，再建对应 html 页面。
const POSTS = [
  {
    slug: "hello-world",
    title: "你好，我的个人博客上线了",
    date: "2026-11-04",
    tag: "随记",
    excerpt: "为什么折腾一个博客、打算写点什么，以及这块自留地的来龙去脉。"
  }
];

function renderPosts() {
  const list = document.getElementById("postList");
  if (!list) return;
  list.innerHTML = POSTS.map(p => `
    <a class="post-card card" href="posts/${p.slug}.html">
      <span class="post-date">${p.date}</span>
      <h3>${p.title}</h3>
      <p class="post-excerpt">${p.excerpt}</p>
      <span class="post-tag">${p.tag}</span>
    </a>
  `).join("");
}

document.addEventListener("DOMContentLoaded", renderPosts);
