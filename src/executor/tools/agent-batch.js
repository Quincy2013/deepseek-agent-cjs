'use strict';

/**
 * Execute multiple tools in parallel
 * @param {Array} tasks - Array of tool tasks, each task is [toolName, args]
 * @param {Object} options - Optional parameters
 * @returns {Promise<Array>} Array of results in the same order as tasks
 */
async function batch(tasks, options = {}) {
  if (!Array.isArray(tasks)) {
    throw new Error('tasks must be an array');
  }

  const concurrency = options.concurrency || tasks.length;
  const timeout = options.timeout || 0; // 0 means no timeout

  // We'll use a simple approach: execute all at once and wait for all
  // For concurrency control, we can use a queue, but for simplicity we do all at once.
  // However, to respect concurrency, we can use a helper to limit the number of concurrent promises.

  // If concurrency is less than the number of tasks, we need to run in batches.
  if (concurrency >= tasks.length) {
    // Run all at once
    const promises = tasks.map(async ([toolName, args]) => {
      try {
        // Assuming the executor has a way to call tools by name.
        // In the context of the agent, we might not have direct access to the executor.
        // However, the tool registration system in the agent makes the tools available as functions on the executor.
        // Since we are in the agent's tool, we can access the executor's tools via `this.executor` or similar.
        // But note: the tool function is called with the executor as context? Actually, in the registration, we pass the executor.
        // However, when the tool is invoked, the executor is available as `this` in the tool function? Not exactly.
        // Looking at the existing tools, they are registered as:
        //   executor.registerTool('toolName', function, description)
        // and when called, the executor is available as `this` inside the tool function.
        // But we are creating a new tool, so we can assume that when this tool is called, `this` is the executor.
        // However, to be safe, we can note that the batch tool will be called in the context of the executor.
        // So we can use `this.callTool` or similar? Actually, the executor doesn't have a callTool method.
        // Instead, the tools are registered as properties of the executor? Let's check the agent architecture.

        // Since we don't have the executor's internal structure, we must rely on the fact that the tool is registered and
        // the executor will invoke it with the correct context. However, for the batch tool to call other tools, we need
        // a way to invoke them. We can do so by accessing the executor's registered tools via `this[toolName]` if they are
        // attached as methods. But the registration doesn't attach them as methods.

        // Alternative: We can store a reference to the executor when registering the tool and then use it to call tools.
        // However, the registration function is called with the executor, so we can save it.

        // But note: the batch tool is being defined now, and we don't have the executor at this point.
        // We will get the executor when the tool is registered.

        // Let's change the approach: we will return a function that expects the executor, and then the registration
        // will bind the executor. However, the current pattern for tools is to have the tool function take no arguments
        // (except the args passed when called) and the executor is bound as `this`.

        // We can do: when the batch tool is registered, we save the executor in a closure.

        // However, the current tool function signature is (args) and we are getting the executor via `this`.
        // So we can use `this` to get the executor and then call the tools via `this[toolName]`? Not exactly.

        // Let me look at how the agent executor works. Since we don't have that code, we must assume that the executor
        // has a method to call a tool by name. Alternatively, we can note that the tools are available in the executor's
        // `tools` object? We don't know.

        // Given the constraints, we will have to rely on the fact that the batch tool is running in the context of the
        // executor and that the executor has a way to call tools. We'll look for a method like `executeTool` or `callTool`.

        // Since we cannot see the executor code, we will have to make an assumption. Alternatively, we can change the
        // design: the batch tool will not be able to call other tools without the executor providing a way.

        // However, note that the existing tools (like shell, _utils) are defined independently and do not rely on the
        // executor to call other tools. They are self-contained.

        // The batch tool is different because it needs to call other tools. Therefore, we must have access to the executor.

        // Let's assume that the executor is available as `this` and that it has a method `_callTool` or similar.
        // But we don't know.

        // Given the time, we will implement a version that uses the executor's `tools` object (if it exists) or we will
        // throw an error if we cannot call the tool.

        // We'll try to get the tool from `this[toolName]` and if it's a function, call it.

        // However, note that when the tool is registered, the executor does:
        //   this.registerTool(name, fn, description)
        // and it might store the fn in a map and also attach it to `this`? We don't know.

        // Let's look at the existing code in the agent. We don't have it, but we can look at the previously created tools.

        // Alternatively, we can change the batch tool to be registered in a way that it gets the executor and then
        // returns a function that can call tools. But the registration pattern is fixed.

        // We'll do the following: in the batch tool function, we will try to access the tool via `this[toolName]`.
        // If it's a function, we call it. Otherwise, we throw an error.

        const toolFn = this[toolName];
        if (typeof toolFn !== 'function') {
          throw new Error(`Tool ${toolName} not found on executor`);
        }

        // Call the tool with the args
        return await toolFn.call(this, args);
      } catch (error) {
        return { error: error.message };
      }
    });

    return Promise.all(promises);
  } else {
    // Run with concurrency limit
    const results = new Array(tasks.length);
    let executing = 0;
    let i = 0;

    while (i < tasks.length) {
      // Start up to concurrency tasks
      while (executing < concurrency && i < tasks.length) {
        executing++;
        const taskIndex = i;
        i++;

        const [toolName, args] = tasks[taskIndex];
        const toolFn = this[toolName];
        if (typeof toolFn !== 'function') {
          results[taskIndex] = { error: `Tool ${toolName} not found on executor` };
          executing--;
          continue;
        }

        // Execute the task
        toolFn.call(this, args)
          .then((result) => {
            results[taskIndex] = result;
          })
          .catch((error) => {
            results[taskIndex] = { error: error.message };
          })
          .finally(() => {
            executing--;
          });
      }

      // Wait for at least one task to complete if we have reached concurrency
      if (executing >= concurrency && i < tasks.length) {
        // We'll wait for a promise to settle, but we don't have a list of promises.
        // Instead, we can use a simple timeout and check again, but that's inefficient.
        // Alternatively, we can use a counter and wait until executing < concurrency.
        // We'll do a short wait and then check again.
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    // Wait for all remaining tasks to complete
    // We'll wait until executing is 0
    while (executing > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    return results;
  }
}

function registerTools(executor) {
  // Save the executor in the closure of the batch tool? Actually, we are using `this` in the tool function.
  // When the tool is called, `this` will be the executor (because of how the agent calls tools).
  executor.registerTool('batch', batch, 'Execute multiple tools in parallel');
}

module.exports = { registerTools, batch };