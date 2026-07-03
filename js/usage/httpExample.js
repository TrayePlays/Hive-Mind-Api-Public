import { system, world } from "@minecraft/server";
import { api } from "../index";

world.afterEvents.itemUse.subscribe(async ({ itemStack }) => {
    if (itemStack.typeId == "minecraft:diamond") {
        const now = system.currentTick;
        const num = Math.floor(Math.random() * 100) + 1;

        // This website returns random quotes using a ID up to 100
        const uri = `https://dummyjson.com/quotes/${num}`;
        world.sendMessage(`§aFetching ${uri}`);

        const reqData = await api.sendHttpRequest(uri);

        // For getting the stringified version use .data
        world.sendMessage(`§bRaw Data: ${reqData.data}`);

        // For getting data off of it use .getData
        world.sendMessage(`§eAuthor: ${reqData.getData().author}`);
        world.sendMessage(`§dResponse Time: ${(system.currentTick - now) / 20}`);
    }
    if (itemStack.typeId == "minecraft:gold_ingot") {
        const uri = `https://jsonplaceholder.typicode.com/posts`

        // Sending a post request to this example website
        const postData = await api.sendHttpRequest(uri, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                title: 'Hello',
                body: 'World',
                userId: 1,
            }),
        })

        world.sendMessage(`§9Post Result: ${postData.data}`);

        // Website creates a new ID for each post
        world.sendMessage(`§6Id: ${postData.getData().id}`)
    }
})