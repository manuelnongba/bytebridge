// One registry supplies both attachment choices and detection. Add mappings here.
export const ATTACHMENT_LANGUAGES = [
  { id: 'javascript', extensions: ['.js', '.mjs', '.cjs', '.jsx'] },
  { id: 'typescript', extensions: ['.ts', '.tsx', '.mts', '.cts'] },
  { id: 'python', extensions: ['.py', '.pyw', '.pyi'] },
  { id: 'java', extensions: ['.java'] },
  { id: 'c', extensions: ['.c', '.h'] },
  { id: 'cpp', extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'] },
  { id: 'csharp', extensions: ['.cs', '.csx'] },
  { id: 'go', extensions: ['.go'] },
  { id: 'rust', extensions: ['.rs'] },
  {
    id: 'ruby',
    extensions: ['.rb', '.rake'],
    filenames: ['Gemfile', 'Rakefile'],
  },
  { id: 'php', extensions: ['.php', '.phtml'] },
  { id: 'swift', extensions: ['.swift'] },
  { id: 'kotlin', extensions: ['.kt', '.kts'] },
  { id: 'dart', extensions: ['.dart'] },
  { id: 'scala', extensions: ['.scala', '.sc'] },
  { id: 'lua', extensions: ['.lua'] },
  { id: 'r', extensions: ['.r', '.rprofile'] },
  { id: 'perl', extensions: ['.pl', '.pm'] },
  {
    id: 'shell',
    extensions: ['.sh', '.bash', '.zsh'],
    filenames: ['.bashrc', '.zshrc'],
  },
  { id: 'powershell', extensions: ['.ps1', '.psm1', '.psd1'] },
  { id: 'bat', extensions: ['.bat', '.cmd'] },
  { id: 'html', extensions: ['.html', '.htm'] },
  { id: 'css', extensions: ['.css'] },
  { id: 'scss', extensions: ['.scss'] },
  { id: 'less', extensions: ['.less'] },
  { id: 'xml', extensions: ['.xml', '.svg', '.xsl', '.csproj'] },
  {
    id: 'json',
    extensions: ['.json', '.jsonc', '.ipynb'],
    filenames: ['.babelrc'],
  },
  { id: 'yaml', extensions: ['.yaml', '.yml'] },
  { id: 'toml', extensions: ['.toml'], filenames: ['Cargo.lock'] },
  {
    id: 'ini',
    extensions: ['.ini', '.cfg', '.conf'],
    filenames: ['.env', '.gitconfig', '.editorconfig'],
  },
  { id: 'markdown', extensions: ['.md', '.markdown', '.mdx'] },
  { id: 'sql', extensions: ['.sql'] },
  { id: 'graphql', extensions: ['.graphql', '.gql'] },
  {
    id: 'dockerfile',
    filenames: ['Dockerfile', 'Containerfile'],
    prefixes: ['Dockerfile.', 'Containerfile.'],
  },
  {
    id: 'makefile',
    extensions: ['.mk'],
    filenames: ['Makefile', 'GNUmakefile'],
  },
  { id: 'cmake', extensions: ['.cmake'], filenames: ['CMakeLists.txt'] },
  { id: 'hcl', extensions: ['.tf', '.tfvars', '.hcl'] },
  { id: 'vue', extensions: ['.vue'] },
  { id: 'svelte', extensions: ['.svelte'] },
  { id: 'plaintext', extensions: ['.txt', '.log'] },
];

export function detectLanguage(filename, languages = ATTACHMENT_LANGUAGES) {
  const name = filename.split(/[\\/]/).pop().toLowerCase();
  const named = languages.find(
    (language) =>
      language.filenames?.some((file) => file.toLowerCase() === name) ||
      language.prefixes?.some((prefix) =>
        name.startsWith(prefix.toLowerCase()),
      ),
  );
  if (named) return named.id;
  const matches = languages
    .flatMap((language) =>
      (language.extensions || []).map((extension) => ({
        id: language.id,
        extension: extension.toLowerCase(),
      })),
    )
    .sort((a, b) => b.extension.length - a.extension.length);
  return (
    matches.find(({ extension }) => name.endsWith(extension))?.id || 'plaintext'
  );
}
