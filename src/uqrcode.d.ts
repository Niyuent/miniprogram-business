/// <reference types="uqrcodejs" />
declare module 'uqrcodejs' {
  export default class UQRCode {
    data: string;
    size: number;
    canvasContext: unknown;
    make(): void;
    drawCanvas(): void;
  }
}
