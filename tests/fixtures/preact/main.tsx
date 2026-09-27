import { render } from 'preact';

import App from './App';

const target = document.getElementById('app');

if (target) {
	render(<App id="root" />, target);
}
