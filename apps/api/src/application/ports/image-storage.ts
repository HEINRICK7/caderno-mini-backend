export type StoredImageContentType = 'image/png' | 'image/jpeg' | 'image/webp';

export type StoredImage = {
  bytes: Buffer;
  contentType: StoredImageContentType;
};

export interface ImageStorage {
  put(input: { id: string; bytes: Buffer; contentType: StoredImageContentType }): Promise<void>;
  get(id: string): Promise<StoredImage | undefined>;
}
