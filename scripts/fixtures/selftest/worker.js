// A module worker that fetches from the Storybook, relative to itself.
const data = await (await fetch(new URL('./data.json', import.meta.url))).json();
postMessage(`worker:${data.hello}`);
