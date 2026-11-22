// The loopback preview serves the installed snapshots at this URL. When reading
// files directly, setup installs a local-only link to the same private cache.
if (location.protocol === 'file:') {
  document.write('<script src="markets/file-cache.js"><\/script>');
}
