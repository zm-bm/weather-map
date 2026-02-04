export const getTilesUrl = (serverUrl: string, tileSource: string) => {
  return `${serverUrl}/${tileSource}/{z}/{x}/{y}`;
}
