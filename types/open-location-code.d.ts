// The @types/open-location-code package on npm declares these as static methods,
// but the actual "open-location-code" runtime (checked directly in
// node_modules/open-location-code/openlocationcode.js) defines every one of them on
// OpenLocationCode.prototype -- an instance is required. This ambient declaration
// matches the real runtime shape instead of the mismatched community types.
declare module "open-location-code" {
  export interface CodeArea {
    latitudeLo: number;
    longitudeLo: number;
    latitudeHi: number;
    longitudeHi: number;
    codeLength: number;
    latitudeCenter: number;
    longitudeCenter: number;
  }

  export class OpenLocationCode {
    isValid(code: string): boolean;
    isFull(code: string): boolean;
    isShort(code: string): boolean;
    decode(code: string): CodeArea;
    encode(lat: number, lng: number, codeLength?: number): string;
    recoverNearest(shortCode: string, referenceLat: number, referenceLng: number): string;
  }
}
