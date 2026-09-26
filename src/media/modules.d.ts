declare module 'heic-decode' {
  function decode(input: { buffer: Buffer | ArrayBuffer | Uint8Array }): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
  export default decode;
}

declare module 'jpeg-js' {
  const jpeg: {
    encode(img: { data: Buffer | Uint8Array; width: number; height: number }, quality?: number): { data: Buffer; width: number; height: number };
  };
  export default jpeg;
}
