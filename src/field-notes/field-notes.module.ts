import { Module } from '@nestjs/common';
import { FieldNotesController } from './field-notes.controller';
import { FieldNotesService } from './field-notes.service';

@Module({
  controllers: [FieldNotesController],
  providers: [FieldNotesService],
})
export class FieldNotesModule {}
