import { render as $$render, createComponent as $$createComponent, renderComponent as $$renderComponent, maybeRenderHead as $$maybeRenderHead, unescapeHTML as $$unescapeHTML, addAttribute as $$addAttribute, spreadAttributes as $$spreadAttributes, defineScriptVars as $$defineScriptVars } from "astro/compiler-runtime";
import Card from "../components/Card.astro";
const $$Index = $$createComponent(($$result, $$props, $$slots) => {
	const id = "dynamic";
	const props = {
		"data-testid": "spread",
		title: "spread-title"
	};
	const items = ["a", "b"];
	const isActive = true;
	const markup = "<b data-testid=\"in-string\">";
	return $$render`${$$maybeRenderHead($$result)}<main data-testid="static-main" class="main"><p${$$addAttribute(id, "data-testid")} class="dynamic">dynamic</p><p${$$addAttribute(`template-${id}`, "data-testid")}${$$addAttribute(id, "title")}>template</p><p${$$addAttribute(isActive ? "on" : "off", "data-TestId")}${$$addAttribute(["a", { b: isActive }], "class:list")}>upper-case ternary</p><p${$$addAttribute({ a: 1 }.a, "data-testid")}${$$addAttribute(id, "data-cy")}>object</p><p${$$spreadAttributes(props)} class="spread">spread</p>${$$renderComponent($$result, "Card", Card, {
		"data-testid": id,
		"title": "dynamic-card"
	})}${$$renderComponent($$result, "Card", Card, {
		"data-testid": "static-card",
		"title": "static-card"
	})}${$$renderComponent($$result, "my-element", "my-element", {
		"data-testid": id,
		"class": "custom"
	}, { "default": ($$result) => $$render`custom` })}<ul>${items.map((item) => $$render`<li${$$addAttribute(`item-${item}`, "data-testid")}>${item}</li>`)}</ul><svg${$$addAttribute(id, "data-testid")}><path data-testid="path" d="M0"></path></svg><script${$$addAttribute(id, "data-testid")} class="inline">
		const hint = '<i data-testid="inline-body">';
	<\/script><script${$$addAttribute(id, "data-testid")}>(function(){${$$defineScriptVars({ id })}
		console.log(id);
	})();<\/script><p${$$addAttribute(id, "data-testid")}>${$$unescapeHTML(markup)}</p></main>`;
}, "/project/src/pages/index.astro", undefined);
export default $$Index;

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sInNvdXJjZXMiOlsiL3Byb2plY3Qvc3JjL3BhZ2VzL2luZGV4LmFzdHJvIl0sInNvdXJjZXNDb250ZW50IjpbIi0tLVxuaW1wb3J0IENhcmQgZnJvbSAnLi4vY29tcG9uZW50cy9DYXJkLmFzdHJvJztcblxuY29uc3QgaWQgPSAnZHluYW1pYyc7XG5jb25zdCBwcm9wcyA9IHsgJ2RhdGEtdGVzdGlkJzogJ3NwcmVhZCcsIHRpdGxlOiAnc3ByZWFkLXRpdGxlJyB9O1xuY29uc3QgaXRlbXMgPSBbJ2EnLCAnYiddO1xuY29uc3QgaXNBY3RpdmUgPSB0cnVlO1xuY29uc3QgbWFya3VwID0gJzxiIGRhdGEtdGVzdGlkPVwiaW4tc3RyaW5nXCI+Jztcbi0tLVxuXG48bWFpbiBkYXRhLXRlc3RpZD1cInN0YXRpYy1tYWluXCIgY2xhc3M9XCJtYWluXCI+XG5cdDxwIGRhdGEtdGVzdGlkPXtpZH0gY2xhc3M9XCJkeW5hbWljXCI+ZHluYW1pYzwvcD5cblx0PHAgZGF0YS10ZXN0aWQ9e2B0ZW1wbGF0ZS0ke2lkfWB9IHRpdGxlPXtpZH0+dGVtcGxhdGU8L3A+XG5cdDxwIGRhdGEtVGVzdElkPXtpc0FjdGl2ZSA/ICdvbicgOiAnb2ZmJ30gY2xhc3M6bGlzdD17WydhJywgeyBiOiBpc0FjdGl2ZSB9XX0+dXBwZXItY2FzZSB0ZXJuYXJ5PC9wPlxuXHQ8cCBkYXRhLXRlc3RpZD17eyBhOiAxIH0uYX0gZGF0YS1jeT17aWR9Pm9iamVjdDwvcD5cblx0PHAgey4uLnByb3BzfSBjbGFzcz1cInNwcmVhZFwiPnNwcmVhZDwvcD5cblx0PENhcmQgZGF0YS10ZXN0aWQ9e2lkfSB0aXRsZT1cImR5bmFtaWMtY2FyZFwiIC8+XG5cdDxDYXJkIGRhdGEtdGVzdGlkPVwic3RhdGljLWNhcmRcIiB0aXRsZT1cInN0YXRpYy1jYXJkXCIgLz5cblx0PG15LWVsZW1lbnQgZGF0YS10ZXN0aWQ9e2lkfSBjbGFzcz1cImN1c3RvbVwiPmN1c3RvbTwvbXktZWxlbWVudD5cblx0PHVsPntpdGVtcy5tYXAoKGl0ZW0pID0+IDxsaSBkYXRhLXRlc3RpZD17YGl0ZW0tJHtpdGVtfWB9PntpdGVtfTwvbGk+KX08L3VsPlxuXHQ8c3ZnIGRhdGEtdGVzdGlkPXtpZH0+PHBhdGggZGF0YS10ZXN0aWQ9XCJwYXRoXCIgZD1cIk0wXCIgLz48L3N2Zz5cblx0PHNjcmlwdCBpczppbmxpbmUgZGF0YS10ZXN0aWQ9e2lkfSBjbGFzcz1cImlubGluZVwiPlxuXHRcdGNvbnN0IGhpbnQgPSAnPGkgZGF0YS10ZXN0aWQ9XCJpbmxpbmUtYm9keVwiPic7XG5cdDwvc2NyaXB0PlxuXHQ8c2NyaXB0IGRlZmluZTp2YXJzPXt7IGlkIH19IGRhdGEtdGVzdGlkPXtpZH0+XG5cdFx0Y29uc29sZS5sb2coaWQpO1xuXHQ8L3NjcmlwdD5cblx0PHAgc2V0Omh0bWw9e21hcmt1cH0gZGF0YS10ZXN0aWQ9e2lkfSAvPlxuPC9tYWluPlxuIl0sIm1hcHBpbmdzIjoiO0FBQ0EsT0FBQSxVQUFBOztDQUVBLE1BQUEsS0FBQTtDQUNBLE1BQUEsUUFBQTtFQUFBLGVBQUE7RUFBQSxPQUFBO0VBQUE7Q0FDQSxNQUFBLFFBQUEsQ0FBQSxLQUFBLElBQUE7Q0FDQSxNQUFBLFdBQUE7Q0FDQSxNQUFBLFNBQUE7aUJBaUI4Qiw4QkFkOUIsS0FBTSwwQkFBMEIsY0FBYSxFQUN6QyxFQUFBLGVBQUEsSUFBQSxjQUFBLENBQWlCLGlCQUFnQixPQUFPLElBQUksRUFDNUMsRUFBQSxlQUFhLFlBQUEsTUFBQSxjQUFBLENBQWtCLEVBQUEsZUFBQSxJQUFBLFFBQUEsQ0FBQSxDQUFXLFFBQVEsSUFBSSxFQUN0RCxFQUFBLGVBQWEsV0FBVyxPQUFPLE9BQUEsY0FBQSxDQUFPLEVBQUEsZUFBWSxDQUFDLEtBQUssRUFBQSxHQUFLLFVBQUEsQ0FBQSxFQUFBLGFBQUEsQ0FBQSxDQUFhLGtCQUFrQixJQUFJLEVBQ2hHLEVBQUEsZUFBYSxFQUFBLEdBQUssR0FBQSxDQUFBLEdBQUEsY0FBQSxDQUFPLEVBQUEsZUFBQSxJQUFBLFVBQUEsQ0FBQSxDQUFhLE1BQU0sSUFBSSxFQUNoRCxFQUFBLG1CQUFJLE1BQUEsQ0FBTyxnQkFBZSxNQUFNLElBQUksRUFDdkMsa0JBQUEsVUFBQSxRQUFBLE1BQUE7RUFBTSxlQUFBO0VBQWlCLFNBQUE7RUFBQSxDQUFBLENBQXVCLEVBQzlDLGtCQUFBLFVBQUEsUUFBQSxNQUFBO0VBQU0sZUFBQTtFQUEwQixTQUFBO0VBQUEsQ0FBQSxDQUFzQixFQUN0RCxrQkFBQSxVQUFBLGNBQUEsY0FBQTtFQUFZLGVBQUE7RUFBaUIsU0FBQTtFQUFBLEVBQUEsRUFBQSxZQUFBLGFBQUEsUUFBQSxDQUFlLFNBQU0sQ0FBQSxDQUFhLElBQzNELEVBQUMsTUFBQSxLQUFVLFNBQUEsUUFBQSxDQUFVLEdBQUksRUFBQSxlQUFhLFFBQUEsUUFBQSxjQUFBLENBQUEsQ0FBZ0IsRUFBQSxLQUFNLE9BQUEsQ0FBTyxLQUFLLElBQ3ZFLEVBQUEsZUFBQSxJQUFBLGNBQUEsQ0FBQSxDQUFpQixLQUFNLG1CQUFtQixlQUFTLE1BQU0sT0FDNUMsRUFBQSxlQUFBLElBQUEsY0FBQSxDQUFpQjs7b0JBR04sZUFBQSxJQUFBLGNBQUEsQ0FBQSxlQUFBLG1CQUFBLEVBQUEsSUFBQSxDQUFBLENBQUE7O29CQUdSLGVBQUEsSUFBQSxjQUFBLENBQUEsQ0FBbEIsRUFBQSxlQUFBLE9BQUEsQ0FBQSxJQUFxQyJ9
const $$file = "/project/src/pages/index.astro";
const $$url = "";export { $$file as file, $$url as url };
