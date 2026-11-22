(() => {
  const pet = document.querySelector('t800-companion');
  const dock = document.querySelector('.pet-dock');
  const status = document.querySelector('.pet-status');
  const hint = document.querySelector('.pet-hint');
  const actions = document.querySelector('.pet-actions');
  const labels = {
    opening: '入势', idle: '待机', look: '视线跟随', drag: '拖动中', land: '落地缓冲',
    wave: '挥手致意', flurry: '刺拳直拳勾拳', turn: '后腿低扫', bound: '闪避反击',
    step: '进退步法', scan: '回身巡视'
  };

  if (!pet || typeof pet.move !== 'function') {
    if (hint) hint.textContent = '这个浏览器未能载入 T800 桌宠。';
    return;
  }

  let parked = true;
  function park() {
    if (!dock) return;
    const bounds = dock.getBoundingClientRect();
    const header = document.querySelector('.site-header');
    const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
    pet.move(bounds.left + (bounds.width - pet.offsetWidth) / 2,
      Math.max(headerBottom + 4, bounds.top + (bounds.height - pet.offsetHeight) / 2));
  }

  // 只在 3D 就绪后才允许点动作按钮：立绘兜底时点了也不会有动画，索性禁用
  function reflect() {
    const ready = pet.dataset.render === '3d';
    const fallback = pet.dataset.render === 'poster';
    if (actions) {
      actions.querySelectorAll('button').forEach((button) => {
        button.disabled = !ready;
      });
    }
    if (fallback && hint) hint.textContent = '当前浏览器显示 T800 的静态模型，仍可拖住它移动。';
    if (status) status.textContent = '当前动作 · ' + (labels[pet.dataset.state] || '待机');
  }

  park();
  new MutationObserver(reflect).observe(pet, {attributes: true, attributeFilter: ['data-render']});
  reflect();
  pet.addEventListener('t800-state', (event) => {
    if (event.detail === 'drag') parked = false;
    reflect();
  });
  pet.addEventListener('keydown', (event) => {
    if (event.key.startsWith('Arrow')) parked = false;
  });
  window.addEventListener('resize', () => { if (parked) park(); });
  document.fonts?.ready.then(() => { if (parked) park(); });

  if (actions) {
    actions.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button || button.disabled) return;
      pet.act(button.dataset.action);
      if (button.dataset.action === 'reset') {
        parked = true;
        park();
      }
    });
  }
})();
