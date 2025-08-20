import { createServer } from 'node:http'
import { createYoga } from 'graphql-yoga'
import { schema } from '../src/graphql/schema'

// Create a Yoga instance with a GraphQL schema
   const yoga = createYoga({ schema })

// Hook Yoga into an HTTP server
const server = createServer(yoga)

// Start server
server.listen(4000, () => {
  console.info('Server is running on http://localhost:4000/graphql')
})
