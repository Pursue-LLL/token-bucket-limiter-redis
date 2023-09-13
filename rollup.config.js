import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import copy from 'rollup-plugin-copy';

export default {
  input: 'src/index.js', // 入口文件改为 .ts 文件
  output: [
    {
      file: 'dist/bundle.cjs',
      format: 'cjs',
      sourcemap: true,
    },
    {
      file: 'dist/bundle.js',
      format: 'esm',
      sourcemap: true,
    },
  ],
  plugins: [
    commonjs(), // 转换为es模块
    terser({
      sourceMap: true,
    }),
    copy({
      targets: [
        { src: 'src/index.d.ts', dest: 'dist/types' },
      ],
    }),
  ],
};


