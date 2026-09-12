/**
 * Pan/zoom camera over the ecliptic plane. World units are AU; the camera
 * projects straight down the z axis, which is what a system map wants.
 */

export class Camera {
  /** Centre of the view in world AU. */
  x = 0;
  y = 0;
  /** Pixels per AU. */
  scale = 20;
  width = 1;
  height = 1;

  /** Widest and tightest useful zoom: the whole Kuiper belt down to ~15000 km. */
  static readonly MIN_SCALE = 2;
  static readonly MAX_SCALE = 8e7;

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  worldToScreenX(wx: number): number {
    return this.width / 2 + (wx - this.x) * this.scale;
  }

  worldToScreenY(wy: number): number {
    // Screen y grows downward; ecliptic +y should point up.
    return this.height / 2 - (wy - this.y) * this.scale;
  }

  screenToWorldX(sx: number): number {
    return this.x + (sx - this.width / 2) / this.scale;
  }

  screenToWorldY(sy: number): number {
    return this.y - (sy - this.height / 2) / this.scale;
  }

  panByPixels(dx: number, dy: number): void {
    this.x -= dx / this.scale;
    this.y += dy / this.scale;
  }

  /** Zoom by `factor`, keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const wx = this.screenToWorldX(sx);
    const wy = this.screenToWorldY(sy);
    this.setScale(this.scale * factor);
    this.x = wx - (sx - this.width / 2) / this.scale;
    this.y = wy + (sy - this.height / 2) / this.scale;
  }

  setScale(scale: number): void {
    this.scale = Math.max(Camera.MIN_SCALE, Math.min(Camera.MAX_SCALE, scale));
  }

  centerOn(wx: number, wy: number): void {
    this.x = wx;
    this.y = wy;
  }

  /** Half-width of the view in AU - handy for culling. */
  get halfSpanAu(): number {
    return Math.max(this.width, this.height) / 2 / this.scale;
  }
}
