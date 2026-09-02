// src/host.ts
import Schema from "@deepseek-ai/schemastery";
var policySchema = Schema.object({
  hidden: Schema.dict(Schema.boolean()).default({}),
  order: Schema.dict(Schema.number()).default({}),
  labels: Schema.dict(Schema.string()).default({})
});
var name = "dsh-settings-manager";
function apply(ctx) {
  ctx.inject(["settings"], (sctx) => {
    sctx.settings.register("settings-manager", policySchema);
  });
}
export {
  apply,
  name
};
