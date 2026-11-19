import { fromB } from './nested/mod-b.js';
export const fromA = () => `a+${fromB()}`;
