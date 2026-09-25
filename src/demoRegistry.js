const modules = import.meta.glob("./demos/*.jsx", { eager: true });
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const DEMOS = Object.entries(modules)
  .map(([file, module]) => {
    if (!module.demo || typeof module.default !== "function") {
      throw new Error(`${file} must export demo metadata and a default component.`);
    }
    if (!ID_PATTERN.test(module.demo.id ?? "")) {
      throw new Error(`${file} has an invalid demo id: ${module.demo.id}`);
    }
    return { ...module.demo, Component: module.default };
  })
  .sort((left, right) => (left.order ?? 100) - (right.order ?? 100));

const ids = new Set();
for (const demo of DEMOS) {
  if (ids.has(demo.id)) throw new Error(`Duplicate demo id: ${demo.id}`);
  ids.add(demo.id);
}
