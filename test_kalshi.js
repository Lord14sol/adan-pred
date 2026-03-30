import { checkKalshiResolution, kalshiFetch } from './src/api/kalshi.js';

async function main() {
  const ticker = 'KXBTCD-26MAR1723-T74249.99';
  const data = await kalshiFetch(`/markets/${ticker}`);
  console.log('RAW DATA:');
  console.log(JSON.stringify(data, null, 2));
  
  const res = await checkKalshiResolution(ticker);
  console.log('RESOLUTION CHECK:');
  console.log(res);
}
main();
