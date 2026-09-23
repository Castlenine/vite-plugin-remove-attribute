import { render as $$render, createAstro as $$createAstro, createComponent as $$createComponent, maybeRenderHead as $$maybeRenderHead, addAttribute as $$addAttribute, spreadAttributes as $$spreadAttributes } from "astro/compiler-runtime";
const $$Astro = $$createAstro("https://astro.build");
const Astro = $$Astro;
const $$Card = $$createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Card;
	const { title, ...rest } = Astro.props;
	return $$render`${$$maybeRenderHead($$result)}<div${$$spreadAttributes(rest)} class="card"><h2${$$addAttribute(`card-${title}`, "data-testid")}>${title}</h2></div>`;
}, "/project/src/components/Card.astro", undefined);
export default $$Card;

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sInNvdXJjZXMiOlsiL3Byb2plY3Qvc3JjL2NvbXBvbmVudHMvQ2FyZC5hc3RybyJdLCJzb3VyY2VzQ29udGVudCI6WyItLS1cbmNvbnN0IHsgdGl0bGUsIC4uLnJlc3QgfSA9IEFzdHJvLnByb3BzO1xuLS0tXG5cbjxkaXYgey4uLnJlc3R9IGNsYXNzPVwiY2FyZFwiPjxoMiBkYXRhLXRlc3RpZD17YGNhcmQtJHt0aXRsZX1gfT57dGl0bGV9PC9oMj48L2Rpdj5cbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0NBQ0EsTUFBQSxFQUFBLE9BQUEsR0FBQSxTQUFBLE1BQUE7K0NBR0EsSUFBSyxFQUFBLG1CQUFJLEtBQUEsQ0FBTSxjQUFhLEdBQUksRUFBQSxlQUFhLFFBQUEsU0FBQSxjQUFBLENBQUEsQ0FBaUIsRUFBQSxNQUFPLEtBQUsifQ==
const $$file = "/project/src/components/Card.astro";
const $$url = undefined;export { $$file as file, $$url as url };
