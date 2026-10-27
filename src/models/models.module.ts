import { Global, Module } from '@nestjs/common';
import { ModelsService } from './models.service';
import { OpenAiAdapter } from './openai.adapter';

@Global()
@Module({
  providers: [
    { provide: OpenAiAdapter, useFactory: () => OpenAiAdapter.fromEnv() },
    ModelsService,
  ],
  exports: [ModelsService],
})
export class ModelsModule {}
