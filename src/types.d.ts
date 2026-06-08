// The three.js example modules ("addons") don't always ship matching type
// declarations through the "three/addons/*" subpath. Treat them as untyped so
// the build never blocks; runtime resolution is handled by three's exports map.
declare module 'three/addons/*';
