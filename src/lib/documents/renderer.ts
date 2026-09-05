export interface DocumentRenderer<TInput, TOutput> {
  render(input: TInput): Promise<TOutput>;
}
