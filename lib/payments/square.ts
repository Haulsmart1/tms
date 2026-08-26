import { SquareClient, SquareEnvironment } from "square";

let squareClient: SquareClient | null = null;

export function getSquare(): SquareClient {
  if (typeof window !== "undefined") {
    throw new Error("Square server client cannot be used in the browser.");
  }

  const token = process.env.SQUARE_ACCESS_TOKEN;
  const environment = process.env.SQUARE_ENVIRONMENT;

  if (!token) {
    throw new Error("SQUARE_ACCESS_TOKEN is not configured.");
  }

  if (environment !== "sandbox" && environment !== "production") {
    throw new Error(
      "SQUARE_ENVIRONMENT must be 'sandbox' or 'production'."
    );
  }

  if (!squareClient) {
    squareClient = new SquareClient({
      token,
      environment:
        environment === "sandbox"
          ? SquareEnvironment.Sandbox
          : SquareEnvironment.Production,
    });
  }

  return squareClient;
}

export function getSquareLocationId(): string {
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!locationId) {
    throw new Error("SQUARE_LOCATION_ID is not configured.");
  }
  return locationId;
}
