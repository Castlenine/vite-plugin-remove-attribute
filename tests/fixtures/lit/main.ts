import { MyElement } from './my-element';

const target = document.getElementById('app');

if (target) {
	target.innerHTML = new MyElement().render();
}
