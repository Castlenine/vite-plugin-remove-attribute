import { render } from 'solid-js/web';

import App from './App';

const target = document.getElementById('app');

if (target) {
	render(() => <App id="root" />, target);
}
