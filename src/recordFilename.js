const MAX_SLUG_LENGTH = 80;
const KNOWN_EXTENSIONS = /\.(mp4|webm|gif)$/i;

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, '');
}

export function resolveRecordFilename({ testNames, filename, format }) {
  const extension = `.${format}`;

  if (filename) {
    return KNOWN_EXTENSIONS.test(filename) ? filename : `${filename}${extension}`;
  }

  if (testNames.length === 1) {
    const slug = slugify(testNames[0]);
    if (slug) return `${slug}${extension}`;
  }

  return `run${extension}`;
}
