/** Submit the same accumulated, compressed, and ordered files shown in the preview. */
export function withSelectedPostPhotos(formData: FormData, photos: readonly File[]): FormData {
  // Native inputs only retain the most recent selection. Do not assign input.files:
  // older mobile browsers may not implement the DataTransfer constructor/setter.
  formData.delete("photos");
  for (const photo of photos) formData.append("photos", photo, photo.name);
  return formData;
}
