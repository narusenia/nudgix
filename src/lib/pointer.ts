// 最後にカーソルがあった位置（エディタの画面の座標）。パレットをカーソルの下に出すのに使う
export const pointer = { x: innerWidth / 2, y: 80 };

addEventListener('pointermove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
});
