import { Component } from '@angular/core';

@Component({
	selector: 'app-apostrophes',
	template: '<p data-testid="apostrophes-template" data-cy="apostrophes-cy" class="apostrophes">data-testid="text"</p>',
})
class ApostrophesComponent {}

@Component({ selector: 'app-quotes', template: "<p data-testid='quotes-template' class='quotes'>quotes</p>" })
class QuotesComponent {}

export { ApostrophesComponent, QuotesComponent };
