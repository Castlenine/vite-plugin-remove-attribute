import { Component } from '@angular/core';

import { ApostrophesComponent, QuotesComponent } from './quoted.component';

const VARIANT = 'compact';

@Component({
	selector: 'app-root',
	imports: [ApostrophesComponent, QuotesComponent],
	template: `
		<app-apostrophes />
		<app-quotes />
		<div data-testid="wrapper" data-cy="wrapper-cy" class="container" id="app">
			<p [attr.data-testid]="dynamicId" class="status">status</p>
			<button (click)="increment()" data-testid="increment" class="btn">+</button>
			<p data-testid="${VARIANT === 'compact' ? "variant-compact" : "variant-wide"}" class="variant">variant</p>
			<p data-testid='${VARIANT === 'compact' ? 'single-compact' : 'single-wide'}' [attr.title]="dynamicId" class="single">single</p>
			<p data-testid="${VARIANT === 'compact' ? "literal-compact" : `literal-${VARIANT}`}" class="literal">literal</p>
			<p title="${VARIANT === 'compact' ? "title-compact" : "title-wide"}" class="kept">kept</p>
		</div>
	`,
})
class AppComponent {
	dynamicId = 'x';

	increment(): void {
		console.log('increment');
	}
}

export { AppComponent };
