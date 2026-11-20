// Last cursor position (editor screen coordinates). Used to open the palette under the cursor
export const pointer = { x: innerWidth / 2, y: 80 };

addEventListener('pointermove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
});
