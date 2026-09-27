function html(strings: TemplateStringsArray, ...values: unknown[]): string {
	return strings.reduce((accumulator, part, index) => `${accumulator}${part}${String(values[index] ?? '')}`, '');
}

function css(strings: TemplateStringsArray, ...values: unknown[]): string {
	return strings.reduce((accumulator, part, index) => `${accumulator}${part}${String(values[index] ?? '')}`, '');
}

const STYLES = css`
	.wrapper {
		color: red;
	}
`;

class MyElement {
	id = 'x';
	disabled = false;
	value = 'v';

	onClick(): void {
		console.log('clicked');
	}

	render(): string {
		return html`
			<div data-testid=${this.id} class="wrapper">
				<span data-testid="${this.id}-label" class="label">label</span>
				<input
					?disabled=${this.disabled}
					.value=${this.value}
					@click=${() => this.onClick()}
					data-testid="input"
					class="field"
				/>
				<p data-testid="${this.disabled ? "lit-double-on" : "lit-double-off"}" class="double">double</p>
				<p data-testid='${this.disabled ? 'lit-single-on' : 'lit-single-off'}' class="single">single</p>
				<p data-testid="${this.disabled ? 'lit-other-on' : 'lit-other-off'}" class="other">other</p>
				<p data-testid="${this.disabled ? "lit-literal-on" : `lit-literal-${this.id}`}" class="literal">literal</p>
				<p data-testid="${this.id}-${this.value}" class="placeholders">placeholders</p>
				<p data-testid="${{ key: "lit-object" }.key}" class="object">object</p>
				<p data-testid="${this.disabled ? "lit-brace-}" : "lit-brace-{"}" class="brace">brace</p>
				<p data-testid="${/* a "}" in a comment */ this.id}" class="comment">comment</p>
				<p data-testid="${/[}"]/.test(this.value) ? "lit-regex-on" : "lit-regex-off"}" class="regex">regex</p>
				<section data-testid="${html`<b data-testid="lit-inner-${this.id}" class="inner">inner</b>`}" class="nested">
					nested
				</section>
				<p
					data-testid="${this.disabled
						? "lit-multi-line-on"
						: "lit-multi-line-off"}"
					class="multi-line"
				>
					multi-line
				</p>
				<p data-testid="${this.id}"data-cy="${this.disabled ? "lit-cy-on" : "lit-cy-off"}"class="minified">minified</p>
				<p data-testid="${this.id}" data-cy="${this.value}" class="back-to-back">back-to-back</p>
				<p data-testid="$price" class="lone-dollar">lone dollar</p>
				<p data-testid="\${escaped}" class="escaped">escaped</p>
				<p title="${this.disabled ? "lit-kept-on" : "lit-kept-off"}" class="kept">kept</p>
			</div>
		`;
	}
}

export { MyElement, STYLES };
