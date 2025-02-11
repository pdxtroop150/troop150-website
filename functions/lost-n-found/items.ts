interface Env {
    LOST_AND_FOUND_ITEMS: R2Bucket;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
    try {
      let input = await context.request.formData();
      console.log(input);

      const formDataObj = {
        fname: input.get('fname') as string,
        description: input.get('description') as string
      };

      const image = input.get('image') as File;
      

      const uuid = crypto.randomUUID();
      await context.env.LOST_AND_FOUND_ITEMS.put(uuid, image, {customMetadata:formDataObj})

      console.log(uuid);
      return new Response("Thanks");
    } catch (err) {
      console.error(`Error parsing JSON content: ${err}`);
      return new Response("Error parsing JSON content", { status: 400 });
    }
  }

  export const onRequestGet: PagesFunction<Env> = async (context) => {
    try {
      const options: R2ListOptions = { 
        include: ["customMetadata"],
      };
      

      const listed = await context.env.LOST_AND_FOUND_ITEMS.list(options as R2ListOptions);

      let truncated = listed.truncated;
      let cursor = listed.truncated ? listed.cursor : undefined;
  
      while (truncated) {
        const next = await context.env.LOST_AND_FOUND_ITEMS.list({
          ...options,
          cursor: cursor,
        });
        listed.objects.push(...next.objects);
      
        truncated = next.truncated;
        cursor = next.truncated ? next.cursor : undefined;
        
      }
      
     

      const items = listed.objects.map(item => ({
        ...item.customMetadata,
        id: item.key
      }))
      return new Response(JSON.stringify(items), {
        headers: {
          'Content-Type': 'application/json',
        },
      });

    } catch (err) {
      console.error(`Error fetching items: ${err}`)
      return new Response("Error fetching items", { status: 400 })
    }
  }
