import { Module } from '@nestjs/common';
import { OptionalAuthGuard } from 'src/common/guards/optional-auth.guard';
import { GuidesController } from './guides.controller';
import { GuidesService } from './guides.service';
import { ReviewsService } from './reviews.service';

@Module({
  controllers: [GuidesController],
  providers: [GuidesService, ReviewsService, OptionalAuthGuard],
  exports: [GuidesService],
})
export class GuidesModule {}
