import CopyPlugin from 'copy-webpack-plugin';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate config for each Electron target (main, preload, renderer)
 * @param {string} target - electron-main | electron-preload | web
 * @param {string} entry - entry file path
 * @param {string} outDir - output directory
 * @param {string} outFile - output filename
 * @param {object[]} plugins - extra plugins
 */
function createConfig({ target, entry, outDir, plugins = [] }) {
  return {
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    target,
    entry,
    output: {
      filename: '[name].js',
      path: path.resolve(__dirname, outDir),
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        { test: /\.ts$/, use: 'ts-loader' },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] },
        {
          test: /\.ttf$/,
          type: 'asset/resource',
          generator: { filename: 'fonts/[name][ext]' },
        },
      ],
    },
    plugins,
  };
}

export default [
  // Preload
  createConfig({
    target: 'electron-preload',
    entry: { preload: './src/preload/preload.ts' },
    outDir: 'dist/preload',
  }),

  // Renderer (Monaco + browser)
  createConfig({
    target: 'web',
    entry: {
      renderer: './src/renderer/renderer.js',
      'editor.worker': 'monaco-editor/esm/vs/editor/editor.worker.js',
      'json.worker': 'monaco-editor/esm/vs/language/json/json.worker',
      'css.worker': 'monaco-editor/esm/vs/language/css/css.worker',
      'html.worker': 'monaco-editor/esm/vs/language/html/html.worker',
      'ts.worker': 'monaco-editor/esm/vs/language/typescript/ts.worker',
    },
    outDir: 'dist/renderer',
    plugins: [
      new CopyPlugin({
        patterns: [
          { from: './src/renderer/styles.css', to: 'styles.css' },
          { from: './src/renderer/index.html', to: 'index.html' },
        ],
      }),
    ],
  }),
];
