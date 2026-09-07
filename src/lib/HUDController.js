export class HUDController {
  constructor(options) {
    this.onProgressChange = options.onProgressChange || (() => {});
    this.targetProgress = 0.0;
    this.currentProgress = 0.0;
  }

  update(deltaTime) {
    // Scroll progress disabled
  }
}
