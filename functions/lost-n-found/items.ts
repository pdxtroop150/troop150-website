interface Env {
    LOST_AND_FOUND_ITEMS: R2Bucket;
}
/*
export const onRequest: PagesFunction<Env> = async (context) => {
    context.
}
*/
export const onRequestPost: PagesFunction<Env> = async (context) => {
    try {
      let input = await context.request.formData();
      console.log(input);

      const formDataObj = {};
      input.forEach((value, key) => (formDataObj[key] = value));

      const uuid = crypto.randomUUID()
      await context.env.LOST_AND_FOUND_ITEMS.put(uuid, "image", {customMetadata:formDataObj})

      console.log(uuid);
      return new Response("Thanks");
    } catch (err) {
      return new Response("Error parsing JSON content", { status: 400 });
    }
  }